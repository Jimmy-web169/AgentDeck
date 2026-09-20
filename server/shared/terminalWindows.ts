import { execFile } from 'node:child_process'

// Windows has no lsof. Inspect duplicated disk-file handles from the pane's
// process tree; never infer ownership from a transcript's folder or timestamp.
// Keep the native probe in a disposable, timeout-bounded PowerShell process.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$roots = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class AgentDeckFiles {
  [StructLayout(LayoutKind.Sequential)]
  struct HandleEntry {
    public IntPtr Object;
    public UIntPtr ProcessId, Handle;
    public uint Access;
    public ushort BackTrace, Type;
    public uint Attributes, Reserved;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct ProcessEntry {
    public uint Size, Usage, Id;
    public UIntPtr Heap;
    public uint Module, Threads, Parent;
    public int Priority;
    public uint Flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Exe;
  }
  [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);
  [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int type, IntPtr buffer, int length, out int needed);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool DuplicateHandle(IntPtr source, UIntPtr handle, IntPtr target, out IntPtr copy, uint access, bool inherit, uint options);
  [DllImport("kernel32.dll")] static extern uint GetFileType(IntPtr handle);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern uint GetFinalPathNameByHandleW(IntPtr handle, StringBuilder path, uint length, uint flags);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  static HashSet<uint> ProcessTree(uint[] roots) {
    var ids = new HashSet<uint>(roots);
    var rows = new List<ProcessEntry>();
    IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
    if (snapshot == new IntPtr(-1)) return new HashSet<uint>();
    try {
      var entry = new ProcessEntry { Size = (uint)Marshal.SizeOf(typeof(ProcessEntry)) };
      if (Process32FirstW(snapshot, ref entry)) do { rows.Add(entry); } while (Process32NextW(snapshot, ref entry));
    } finally { CloseHandle(snapshot); }
    for (int depth = 0; depth < 3; depth++) {
      var parents = new HashSet<uint>(ids);
      foreach (var entry in rows) if (parents.Contains(entry.Parent)) ids.Add(entry.Id);
    }
    return ids;
  }

  public static string[] Read(uint[] roots) {
    var owned = new Dictionary<uint, IntPtr>();
    var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    IntPtr buffer = IntPtr.Zero;
    try {
      foreach (uint pid in ProcessTree(roots)) {
        IntPtr process = OpenProcess(0x40, false, pid);
        if (process != IntPtr.Zero) owned.Add(pid, process);
      }
      if (owned.Count == 0) return new string[0];
      int size = 1024 * 1024, needed, status;
      while (true) {
        buffer = Marshal.AllocHGlobal(size);
        status = NtQuerySystemInformation(64, buffer, size, out needed);
        if (status == 0) break;
        Marshal.FreeHGlobal(buffer); buffer = IntPtr.Zero;
        if (status != unchecked((int)0xC0000004) || size >= 64 * 1024 * 1024) return new string[0];
        size = Math.Min(64 * 1024 * 1024, Math.Max(size * 2, needed));
      }
      long count = Marshal.ReadIntPtr(buffer).ToInt64();
      int offset = IntPtr.Size * 2, stride = Marshal.SizeOf(typeof(HandleEntry));
      if (count < 0 || count > (size - offset) / stride) return new string[0];
      for (long i = 0; i < count; i++) {
        var entry = (HandleEntry)Marshal.PtrToStructure(IntPtr.Add(buffer, offset + (int)i * stride), typeof(HandleEntry));
        ulong pid = entry.ProcessId.ToUInt64();
        IntPtr process, copy;
        if (pid > uint.MaxValue || !owned.TryGetValue((uint)pid, out process)) continue;
        if (!DuplicateHandle(process, entry.Handle, GetCurrentProcess(), out copy, 0, false, 2)) continue;
        try {
          if (GetFileType(copy) != 1) continue;
          var name = new StringBuilder(32768);
          uint length = GetFinalPathNameByHandleW(copy, name, (uint)name.Capacity, 0);
          if (length == 0 || length >= name.Capacity) continue;
          string file = name.ToString();
          if (file.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) file = @"\\" + file.Substring(8);
          else if (file.StartsWith(@"\\?\")) file = file.Substring(4);
          paths.Add(file);
        } finally { CloseHandle(copy); }
      }
      var result = new string[paths.Count]; paths.CopyTo(result); return result;
    } finally {
      if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
      foreach (var process in owned.Values) CloseHandle(process);
    }
  }
}
'@
ConvertTo-Json -Compress -InputObject @([AgentDeckFiles]::Read([uint32[]]$roots))
`

// Compiling the probe costs about half a second per run. The inventory reads
// synchronously on every poll, so the probe runs in the background and each
// call answers with the last completed result: the first poll after a rollout
// opens sees nothing (missing evidence keeps the terminal attachable), the next
// one sees the handle. No poll ever blocks the HTTP host on PowerShell.
const FRESH_MS = 2500
const FORGET_MS = 60000
interface Probe {
  files: string[]
  at: number
  used: number
  pending: Promise<void> | null
}
const probes = new Map<string, Probe>()

function readHandles(pids: number[]): Promise<string[]> {
  return new Promise((resolve) => {
    const child = execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')],
      { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error) return resolve([])
        try {
          const files: unknown = JSON.parse(stdout.replace(/^\uFEFF/, '').trim())
          resolve(Array.isArray(files) ? files.filter((file): file is string => typeof file === 'string') : [])
        } catch {
          // Access denied, unsupported native APIs and exited processes are all
          // missing evidence. Keep the terminal usable and retry on the next poll.
          resolve([])
        }
      }
    )
    child.stdin?.end(JSON.stringify(pids))
  })
}

export function windowsProcessFiles(roots: number[]): string[] {
  const pids = [...new Set(roots.filter((pid) => Number.isSafeInteger(pid) && pid > 0 && pid <= 0xffffffff))].sort((a, b) => a - b)
  if (!pids.length) return []
  const now = Date.now()
  for (const [key, probe] of probes) if (!probe.pending && now - probe.used > FORGET_MS) probes.delete(key)
  const key = pids.join(',')
  const probe = probes.get(key) || { files: [], at: 0, used: now, pending: null }
  probes.set(key, probe)
  probe.used = now
  if (!probe.pending && now - probe.at >= FRESH_MS) {
    probe.pending = readHandles(pids)
      .then((files) => {
        probe.files = files
      })
      .finally(() => {
        probe.at = Date.now()
        probe.pending = null
      })
  }
  return probe.files
}

// Tests wait for the background probes instead of sleeping.
export const settleWindowsProcessFiles = () => Promise.all([...probes.values()].map((probe) => probe.pending)).then(() => undefined)
