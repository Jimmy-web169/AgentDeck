export type Ref = { root: string; slug?: string | null; id?: string | null; cwd?: string | null }
export type ResourceRef = Ref & { scope?: string; kind?: string; name?: string; stamp?: string | number }
export type Cut = string | number | null | undefined
export type OpenOptions = { what: string; cwd?: string | null }
export type Params = Record<string, string | number | boolean | null | undefined>
export type Addressing = {
  session: (ref: Ref) => Params
  fork: (ref: Ref, cut?: Cut) => Params
  resources: (ref: ResourceRef) => Params
  deleteResource: (ref: ResourceRef) => Params
  open: (ref: Ref, options: OpenOptions) => Params
}
// Descriptor-owned addressing. No provider identifiers or UI imports.

export const idAddressing: Addressing = {
  session: ({ root, id }) => ({ root, id }),
  fork: ({ root, id }, cut) => ({ root, id, cut: cut ?? null }),
  resources: ({ root, scope, slug }) => (scope === 'project' && slug ? { root, scope, slug } : { root, scope: 'user' }),
  deleteResource: ({ root, scope, slug, kind, name }) =>
    scope === 'project' && slug ? { root, scope, slug, kind, name } : { root, scope: 'user', kind, name },
  open: ({ root, id, slug }, { what, cwd }) => ({ root, id, what, cwd, slug }),
}

export const slugAddressing: Addressing = {
  session: ({ root, slug, id }) => ({ root, slug, id }),
  fork: ({ root, slug, id }, cut) => ({ root, slug, id, cut: cut ?? null }),
  resources: ({ root, slug }) => (slug ? { root, slug } : { root }),
  deleteResource: ({ root, kind, name, stamp, slug }) => (slug ? { root, kind, name, stamp, slug } : { root, kind, name, stamp }),
  open: ({ root, slug, id }, { what, cwd }) => ({ root, slug, id, what, cwd }),
}
