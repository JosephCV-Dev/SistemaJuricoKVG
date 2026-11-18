// Code points from the pinned Bootstrap Icons font. The application serves the font locally.
const glyphs = {
  home: '\uf425',
  person: '\uf4e1',
  people: '\uf4d0',
  folder: '\uf3d9',
  briefcase: '\uf1cc',
  transfer: '\uf12b',
  file: '\uf38b',
  archive: '\uf10d',
  staff: '\uf8a7',
  audit: '\uf444',
  settings: '\uf56b',
  account: '\uf4d7',
  menu: '\uf479',
  close: '\uf659',
  search: '\uf52a',
  add: '\uf64d',
  download: '\uf30a',
  upload: '\uf603',
  edit: '\uf4cb',
  forward: '\uf138',
  back: '\uf12f',
  signIn: '\uf1be',
  signOut: '\uf1c3',
  shield: '\uf52f',
  history: '\uf292',
  summary: '\uf228',
  progress: '\uf2ee',
  review: '\uf28b',
  restore: '\uf117',
} as const;

export type IconName = keyof typeof glyphs;

export function Icon({ name }: { name: IconName }) {
  return (
    <span
      className="app-icon"
      data-icon={name}
      data-glyph={glyphs[name]}
      aria-hidden="true"
    />
  );
}
