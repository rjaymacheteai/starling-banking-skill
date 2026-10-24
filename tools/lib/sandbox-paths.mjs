import path from 'node:path';

export function sandboxPaths(root, profile = 'default') {
  if (!['default', 'individual', 'individual-2', 'joint', 'business'].includes(profile)) {
    throw new Error('Sandbox customer must be individual, individual-2, joint, business or default.');
  }
  const sandboxRoot = path.join(root, '.local', 'sandbox');
  const home = profile === 'default' ? sandboxRoot : path.join(sandboxRoot, profile);
  return {
    home,
    configFile: path.join(home, 'config.json'),
    tokenFile: path.join(home, 'access-token'),
    refreshTokenFile: path.join(home, 'refresh-token'),
    keyDir: path.join(sandboxRoot, 'keys'),
  };
}
