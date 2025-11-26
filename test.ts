import { fetchAllMessages } from "./src";

async function main() {
  const messages = await fetchAllMessages("2627596758", { concurrency: 5 });

  console.log(messages);
}

main().catch((e) => {
  console.error(e);
});
