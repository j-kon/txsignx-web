export const humanize = (text: string) => text.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase())
