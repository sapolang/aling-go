import { create } from 'zustand'

export interface LibraryFile {
  path: string
  name: string
  type: 'video' | 'audio' | 'pdf'
  folderId: string
  addedAt: string
}

export interface Folder {
  id: string
  name: string
  createdAt: string
  parentId: string
}

export type Category = 'all' | 'folder' | 'video' | 'audio' | 'pdf'
export type ViewMode = 'grid' | 'list'
export type SortBy = 'name' | 'addedAt' | 'type'

interface LibraryState {
  files: LibraryFile[]
  folders: Folder[]
  loading: boolean
  category: Category
  viewMode: ViewMode
  sortBy: SortBy
  editing: boolean
  selectedPaths: Set<string>
  currentFolderId: string | null

  load: () => Promise<void>
  setCategory: (c: Category) => void
  setViewMode: (v: ViewMode) => void
  setSortBy: (s: SortBy) => void
  toggleEditing: () => void
  toggleSelect: (path: string) => void
  selectAll: (visibleFolderIds: string[], visibleFilePaths: string[]) => void
  clearSelection: () => void
  setCurrentFolder: (id: string | null) => void
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  files: [],
  folders: [],
  loading: false,
  category: 'all',
  viewMode: 'grid',
  sortBy: 'addedAt',
  editing: false,
  selectedPaths: new Set(),
  currentFolderId: null,

  load: async () => {
    set({ loading: true })
    const data = await window.api.libraryList()
    set({ files: data.files, folders: data.folders, loading: false })
  },

  setCategory: (category) => set({ category, editing: false, selectedPaths: new Set() }),

  setViewMode: (viewMode) => set({ viewMode }),

  setSortBy: (sortBy) => set({ sortBy }),

  toggleEditing: () => {
    const { editing } = get()
    set({ editing: !editing, selectedPaths: new Set() })
  },

  toggleSelect: (path) => {
    const next = new Set(get().selectedPaths)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    set({ selectedPaths: next })
  },

  selectAll: (visibleFolderIds: string[], visibleFilePaths: string[]) => {
    const all = new Set<string>()
    visibleFolderIds.forEach(id => all.add(id))
    visibleFilePaths.forEach(path => all.add(path))
    set({ selectedPaths: all })
  },

  clearSelection: () => set({ selectedPaths: new Set() }),

  setCurrentFolder: (id) => set({ currentFolderId: id, editing: false, selectedPaths: new Set() }),
}))
