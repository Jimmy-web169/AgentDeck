import type { RootInfo, ConversationEvent } from '../../../src/api/models.ts'
import type { useRoots, useSession, useSaveResource, useFork, useSaveMemory, useAddRoot, useRemoveRoot } from '../../../src/api/queries.ts'
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T
type RootsStayTyped = Assert<Equal<NonNullable<ReturnType<typeof useRoots>['data']>['roots'], RootInfo[]>>
type TimelineStaysTyped = Assert<Equal<NonNullable<ReturnType<typeof useSession>['data']>['timeline'], ConversationEvent[]>>
declare const save: ReturnType<typeof useSaveResource>['mutate']
declare const fork: ReturnType<typeof useFork>['mutate']
save({ ref: { root: 'a', kind: 'config', name: 'config.toml', content: 'fixture' } })
fork({ ref: { root: 'a', id: 'one' }, cut: 'turn-one' })
// @ts-expect-error A resource mutation must include content.
save({ ref: { root: 'a', kind: 'config', name: 'config.toml' } })
// @ts-expect-error Mutation arguments are named; positional arrays are not public input.
fork({ ref: { root: 'a', id: 'one' }, args: ['turn-one'] })
declare const memory: ReturnType<typeof useSaveMemory>['mutate']
declare const addRoot: ReturnType<typeof useAddRoot>['mutate']
declare const removeRoot: ReturnType<typeof useRemoveRoot>['mutate']
memory({ ref: { root: 'a', slug: 'project', name: 'MEMORY.md', content: 'fixture' } })
addRoot({ ref: { path: '/fixture/provider', label: 'Synthetic' } })
removeRoot({ ref: { id: 'a' } })
// @ts-expect-error Memory writes require explicit content.
memory({ ref: { root: 'a', name: 'MEMORY.md' } })
// @ts-expect-error Adding a root accepts a path, not a persisted ID.
addRoot({ ref: { id: 'a' } })
// @ts-expect-error Removing a root requires a persisted ID.
removeRoot({ ref: { path: '/fixture/provider' } })
export type TypeAssertions = RootsStayTyped | TimelineStaysTyped
