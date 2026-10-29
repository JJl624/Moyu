export type AttachmentPreviewKind = 'image' | 'drawing' | 'pdf' | 'score';
export function scoreText(path: string): boolean;
export function scoreFile(path: string): boolean;
export function attachmentPreviewKind(href: string, options?: {image?: boolean; standalone?: boolean; platform?: string}): AttachmentPreviewKind | null;
export function standaloneAttachment(paragraph: any, source?: string): boolean;
