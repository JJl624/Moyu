export interface TerminalProfile {
  id: string;
  label: string;
  shell: string;
  arguments: string[];
}
export const profileMatches = (profile: TerminalProfile, shell: string, args: string[] = []) =>
  (profile.shell.toLowerCase() === shell.toLowerCase()
    || profile.shell.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() === shell.toLowerCase())
  && (!profile.id.startsWith('wsl-') || profile.arguments.every((value, index) => args[index] === value));
