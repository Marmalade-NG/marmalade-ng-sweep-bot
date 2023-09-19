import {MarmaladeNGClient} from "./marmalade_ng_client.js";
import YAML from 'yaml';
import {readFile} from 'fs/promises';

async function main()
{
  console.log("Loading config...")
  const config = await readFile("config.yaml", "ascii").then(YAML.parse)
  console.log(config)

  const marmalade = new MarmaladeNGClient(config)

  await marmalade.sweep()
  setInterval( async () => {await marmalade.sweep()},120*1000)
}

main()
