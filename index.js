import {MarmaladeNGClient} from "./marmalade_ng_client.js";
import YAML from 'yaml';
import {readFile} from 'fs/promises';

async function main()
{
  const config_file = process.argv?.[2]??"config.yaml";
  console.log("Loading config...")

  const config = await readFile(config_file, "ascii").then(YAML.parse)
  console.log(config)

  const marmalade = new MarmaladeNGClient(config)

  await marmalade.sweep()
  setInterval( async () => {await marmalade.sweep()},30*1000)
}

main()
