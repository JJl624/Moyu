import { fileKind } from '../shared/file-kind.mjs';
export { fileKind };
export const isNativeImage = (path: string) => fileKind(path.split(/[?#]/)[0]) === 'image';
