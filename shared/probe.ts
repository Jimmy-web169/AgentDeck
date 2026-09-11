// Public probe response shared by the API and browser.
export interface ProbeResult {
  status: string
  details: { level: string; msg: string }[]
  at: string
  files: number
  records: number
  versions: string[]
  fingerprint: string
}
