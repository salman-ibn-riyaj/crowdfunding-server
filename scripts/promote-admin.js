import { connectToDatabase, closeDatabase, getDatabase } from "../src/database.js";

const email = process.argv[2]?.trim().toLowerCase();

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: npm run admin:promote -- user@example.com");
  process.exit(1);
}

try {
  await connectToDatabase();
  const result = await getDatabase().collection("user").updateOne(
    { email },
    { $set: { role: "admin", credits: 0, roleOnboarded: true } },
  );

  if (result.matchedCount !== 1) {
    console.error(`No account found for ${email}. Create the account before promoting it.`);
    process.exitCode = 1;
  } else {
    console.info(`Promoted ${email} to Admin.`);
  }
} catch (error) {
  console.error("Unable to promote account.", error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}