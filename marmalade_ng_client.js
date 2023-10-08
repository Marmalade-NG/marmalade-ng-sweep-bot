import {createClient, Pact, createSignWithKeypair} from '@kadena/client'

/* Ugly workaround for this issue
   https://github.com/kadena-community/kadena.js/issues/935
*/
const NULL_PROOF = {replace:()=>null}

const LOCAL_GAS_LIMIT = 150000

export class MarmaladeNGClient
{
  #client;
  #network;
  #chain;
  #namespace;
  #gas_payer;
  #gas_payer_key;
  #signing;

  constructor({node, network, chain, namespace, gas_payer, gas_payer_key})
  {
    this.#network = network
    this.#chain = chain
    this.#client = createClient(`${node}/chainweb/0.0/${network}/chain/${chain}/pact`);
    this.#namespace = namespace;
    this.#gas_payer = gas_payer;
    this.#gas_payer_key = gas_payer_key.publicKey;
    this.#signing = createSignWithKeypair(gas_payer_key);

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
                   .addSigner(this.#gas_payer_key, (withCapability) => [withCapability('coin.GAS')])
                   .createTransaction()

    return this.#signing(trx)
               .then((x) => this.preflight(x))
               .then((x) => this.#client.send(x))
  }

  current_time()
  {
    return this.local_pact("(free.util-time.now)")
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
    const {"sale-id":sale_id, "current-buyer":buyer, "token-id":token_id} = sale;
    console.log(`Ending ${sale_id}`)

    let cmd;
    if(buyer !== "")
    {

      const buyer_guard = await this.local_pact(`(${this.#namespace}.ledger.account-guard "${token_id}" "${buyer}")`)

      cmd = Pact.builder.continuation({pactId:sale_id, step:1, rollback:false, proof:NULL_PROOF})
                        .setMeta({gasLimit:10000})
                        .addData("buyer",buyer)
                        .addData("buyer-guard",buyer_guard)
    }
    else
    {
      cmd = Pact.builder.continuation({pactId:sale_id, step:0, rollback:true, proof:NULL_PROOF})
                        .setMeta({gasLimit:10000})
    }

    await this.sign_and_send(cmd)
  }

  withdraw_sale(sale)
  {
    const {"sale-id":sale_id} = sale
    console.log(`Ending ${sale_id}`)

    const cmd = Pact.builder.continuation({pactId:sale_id, step:0, rollback:true, proof:NULL_PROOF})
                            .setMeta({gasLimit:10000})

    return this.sign_and_send(cmd)
  }


  async sweep()
  {
    console.log("-------------------------")
    console.log("   Start a sweep round   ")
    console.log("-------------------------")
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
