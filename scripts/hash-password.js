import { hashPassword } from '../src/password.js';

const password = process.argv[2] === '--stdin' ? await readStandardInput() : process.argv[2];
if (!password) {
  console.error('Password wajib diberikan melalui stdin atau argumen pertama.');
  process.exit(1);
}

try {
  process.stdout.write(hashPassword(password));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

async function readStandardInput() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input.replace(/\r?\n$/, '');
}
