import { prisma } from '../src';

async function main() {
  console.log('seed: nothing to do yet');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
