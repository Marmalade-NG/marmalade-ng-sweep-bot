import {createClient, Pact, createSignWithKeypair} from '@kadena/client'
import {getRandomValues} from 'crypto'

const LOCAL_GAS_LIMIT = 150000

export function make_nonce()
{
  const a = new Uint8Array(8);
  getRandomValues(a);
  return "NGB:" + Array.from(a, (x)=>x.toString(16)).join('');
}

export class MarmaladeNGClient
{
  #client;
  #network;
  #chain;
  #namespace;
  #gas_payer;
  #gas_payer_key;
  #signing;

  #sales_map;

  constructor({node, network, chain, namespace, gas_payer, gas_payer_key})
  {
    this.#network = network
    this.#chain = chain
    this.#client = createClient(`${node}/chainweb/0.0/${network}/chain/${chain}/pact`);
    this.#namespace = namespace;
    this.#gas_payer = gas_payer;
    this.#gas_payer_key = gas_payer_key.publicKey;
    this.#signing = createSignWithKeypair(gas_payer_key);
    this.#sales_map = new Map()

  }

  already_ended(sale_id)
  {
    if(this.#sales_map.has(sale_id))
      return true;
    else
    {
      this.#sales_map.set(sale_id, true);
      setTimeout(()=> this.#sales_map.delete(sale_id), 300 * 1000);
      return false;
    }
  }

  local_check(cmd, options)
  {
    return this.#client.local(cmd, options)
          .then( (resp) => { if(resp?.result?.status !== 'success')
                             {
                               console.warn(resp); throw Error("Error in local call");
                             }
                             else
                              return resp.result.data;});
  }

  local_pact(pact_code)
  {
    const cmd = Pact.builder
                    .execution(pact_code)
                    .setMeta({chainId:this.#chain, gasLimit:LOCAL_GAS_LIMIT})
                    .setNetworkId(this.#network)
                    .createTransaction();
    return this.local_check(cmd, {signatureVerification:false, preflight:false})
  }

  async preflight(trx)
  {
    console.log(`Transaction Hash: ${trx.hash}`)
    const res = await this.local_check(trx, {signatureVerification:true, preflight:true})
    console.log(`Local result: ${res}`)
    return trx;
  }

  sign_and_send(cmd)
  {
    const trx = cmd.setMeta({chainId:this.#chain, sender:this.#gas_payer})
                   .setNetworkId(this.#network)
                   .setNonce(make_nonce)
                   .addSigner(this.#gas_payer_key, (withCapability) => [withCapability('coin.GAS')])
                   .createTransaction()

    return this.#signing(trx)
               .then((x) => this.preflight(x))
               .then((x) => this.#client.send(x))
  }

  current_time()
  {
    return this.local_pact("(free.util-time.now)")
               .then(x => new Date(x.timep));
  }

  check_node_time()
  {
    const now = new Date()
    return this.current_time().then(x => now.getTime()-x.getTime())
                              .then(x => x<120_000)
  }

  get_ended_auction_sales()
  {
    return this.local_pact(`(${this.#namespace}.policy-auction-sale.get-ended-sales)`)
  }

  /* For fixed and dutch action => They have the same API so factorize */
  get_ended_sales(sale_type)
  {
    return this.local_pact(`(use free.util-time)
                            (use ${this.#namespace}.ledger [NO-TIMEOUT])
                            (filter (where 'timeout (and? (is-past) (!= NO-TIMEOUT)))
                                    (${this.#namespace}.policy-${sale_type}-sale.get-all-active-sales))`)
  }

  get_ended_fixed_sales()
  {
    return this.get_ended_sales("fixed");
  }

  get_ended_dutch_auction_sales()
  {
    return this.get_ended_sales("dutch-auction");
  }

  async end_auction(sale)
  {
    const {"sale-id":sale_id, "current-buyer":buyer, "token-id":token_id, "shared-fee":shared_fee} = sale;
    if(this.already_ended(sale_id))
      return;
    console.log(`Ending ${sale_id}`)

    let cmd;
    if(buyer !== "")
    {

      const buyer_guard = await this.local_pact(`(${this.#namespace}.ledger.account-guard "${token_id}" "${buyer}")`)

      cmd = Pact.builder.continuation({pactId:sale_id, step:1, rollback:false, proof:null})
                        .setMeta({gasLimit:6000})
                        .addData("buyer",buyer)
                        .addData("marmalade_shared_fee",shared_fee)
                        .addData("buyer-guard",buyer_guard)
    }
    else
    {
      cmd = Pact.builder.continuation({pactId:sale_id, step:0, rollback:true, proof:null})
                        .setMeta({gasLimit:6000})
    }

    await this.sign_and_send(cmd)
  }

  withdraw_sale(sale)
  {
    const {"sale-id":sale_id} = sale
    if(this.already_ended(sale_id))
      return;
    console.log(`Ending ${sale_id}`)

    const cmd = Pact.builder.continuation({pactId:sale_id, step:0, rollback:true, proof:null})
                            .setMeta({gasLimit:6000})

    return this.sign_and_send(cmd)
  }


  async sweep()
  {
    console.log("-------------------------")
    console.log("   Start a sweep round   ")
    console.log("-------------------------")
    if(!await this.check_node_time())
    {
      console.log("Node is not up-to-date => Cancel")
      return
    }

    console.log("Fixed Sales")
    const fixed_sales = await this.get_ended_fixed_sales()

    for (const s of fixed_sales)
    {
      await this.withdraw_sale(s)
    }

    console.log("Dutch auction Sales")
    const dutch_auctions_sales = await this.get_ended_dutch_auction_sales()

    for (const s of dutch_auctions_sales)
    {
      await this.withdraw_sale(s);
    }

    console.log("Auction sales");
    const auctions_sales = await this.get_ended_auction_sales();
    for (const s of auctions_sales)
    {
      await this.end_auction(s);
    }
    console.log("")

  }

}
