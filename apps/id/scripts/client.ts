import "dotenv/config";
import { existsSync, writeFileSync } from "node:fs";
import { prisma } from "../../web/src/lib/prisma";
import { registerClient } from "../../web/src/lib/tzIdClients";
const [name, redirectUri, outputFile, mode] = process.argv.slice(2);
if (!name || !redirectUri || !outputFile)
  throw new Error(
    'Usage: npm run client -w apps/id -- "App" https://app.example/callback /secure/client.json [public]',
  );
if (existsSync(outputFile))
  throw new Error("Output file exists; use a new private file");
try {
  const result = await registerClient({
    name,
    redirectUris: [redirectUri],
    publicClient: mode === "public",
    offlineAccess: true,
  });
  try {
    writeFileSync(outputFile, JSON.stringify(result, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    await prisma.tzIdClient.delete({ where: { id: result.clientId } });
    throw error;
  }
  console.log(
    "Client created. Credentials saved to the specified private file.",
  );
} finally {
  await prisma.$disconnect();
}
