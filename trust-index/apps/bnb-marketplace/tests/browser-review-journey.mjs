/** Real React/browser integration. Start marketplace dev server first, then run:
 * node --experimental-strip-types tests/browser-review-journey.mjs
 * Uses a fresh profile, synthetic wallet, and intercepted external traffic only.
 * No real review publication, wallet signature, or transaction is permitted.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { decodeFunctionData, encodeFunctionResult } from 'viem';
import { COMMERCE_ABI, CONTRACTS, POLICY_ABI, ROUTER_ABI } from '../src/lib/commerce-contracts.ts';

const base = process.env.REVIEW_TEST_URL ?? 'http://localhost:3100';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Only a local preview may be tested');
const buyer = '0x51e048a166D22e2898790a4806652bCFf6F03A36';
const subject = 'reference:97:health-factor';
// Public on-chain job1179 quote: historical fixture, not a private signing key.
const description = JSON.stringify({chain_id:97,currency:'0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565',negotiated_at:1788944026,negotiation_hash:'0x344be2121efb9c56cc4a6b5869895eef589bf12365fa1bb91327fd954823a5be',price:'0',provider_sig:'0x3e59123ce954a92dc3b214b90f9dd1488646477fd35c2bfe592f2e7b11b37b853259288decbc4eefad9e80db166755e5d6deec7463cbf636b06d1e97861f4eab1b',quote_expires_at:1788944926,task:'collateral=12500 debt=6200 threshold=0.825',terms:{deliverables:'Deterministic health factor, threshold comparison and headroom from supplied inputs.',quality_standards:'Fixed-point arithmetic. No live data, financial execution or investment recommendation.'},verifying_contract:'0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE',version:1});
const job = {id:1179n,client:buyer,provider:'0x6f736f824B27F686e6cC5dbd945f9727812a1c72',evaluator:CONTRACTS[97].routerProxy,description,budget:0n,expiredAt:1788946188n,status:3,hook:CONTRACTS[97].routerProxy,submittedAt:1788944253n,deliverable:'0x6139d2c77f3b34900f2ca3cd0702a88b2d8f7ff271e424d2282205c853c9ae77'};
const fakeSignature = `0x${'12'.repeat(65)}`;
const browser = await chromium.launch({channel: 'chrome', headless: true});
try {
  for (const status of [3, 2]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const posts = [], unexpected = [], pageErrors = [];
    let reviewInput, publishedReview;
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.addInitScript(({buyer, fakeSignature}) => {
      window.testWalletCalls = [];
      window.ethereum = {
        async request(args) {
          window.testWalletCalls.push(args);
          if (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') return [buyer];
          if (args.method === 'eth_chainId') return '0x61';
          if (args.method === 'personal_sign') return fakeSignature;
          throw new Error(`Test prohibits wallet method: ${args.method}`);
        }, on() {}, removeListener() {},
      };
    }, {buyer, fakeSignature});
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === new URL(base).origin) return route.continue();
      const json = value => route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(value)});
      if (url.hostname === 'fonts.googleapis.com') return route.fulfill({status:200,contentType:'text/css',body:''});
      if (request.method() === 'OPTIONS') return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'content-type','access-control-allow-methods':'GET,POST,OPTIONS'}});
      if (url.hostname === 'bsc-testnet-dataseed.bnbchain.org') {
        const body = request.postDataJSON();
        const rpc = item => {
          let result;
          if (item.method === 'eth_getBlockByNumber') result = {number:'0x7b',timestamp:`0x${Math.floor(Date.now()/1000).toString(16)}`,transactions:[],hash:`0x${'00'.repeat(32)}`};
          else if (item.method === 'eth_call') {
            const abi = [...COMMERCE_ABI,...ROUTER_ABI,...POLICY_ABI];
            const call = decodeFunctionData({abi,data:item.params[0].data});
            if (call.functionName === 'getJob') { assert.equal(call.args[0],1179n); result=encodeFunctionResult({abi:COMMERCE_ABI,functionName:'getJob',result:{...job,status}}); }
            else if (call.functionName === 'jobPolicy') result=encodeFunctionResult({abi:ROUTER_ABI,functionName:'jobPolicy',result:CONTRACTS[97].policy});
            else if (call.functionName === 'disputeWindow') result=encodeFunctionResult({abi:POLICY_ABI,functionName:'disputeWindow',result:300n});
            else throw new Error(`Unexpected read ${call.functionName}`);
          } else throw new Error(`Prohibited RPC ${item.method}`);
          return {jsonrpc:'2.0',id:item.id,result};
        };
        return json(Array.isArray(body) ? body.map(rpc) : rpc(body));
      }
      if (url.pathname === '/api/reviews') {
        if (request.method() === 'GET') return json(url.searchParams.has('subjects') ? {summaries:[{subject,enabled:true,mainnet:{count:0,average:null,uniqueBuyers:0},testnet:{count:0,average:null,uniqueBuyers:0}}]} : {reviews:publishedReview ? [publishedReview] : [],nextCursor:null});
        const body = request.postDataJSON(); posts.push(body);
        if (body.action === 'challenge') {
          reviewInput=body;
          const issuedAt=Math.floor(Date.now()/1000), expiresAt=issuedAt+600, nonce='ab'.repeat(32);
          const message=['Nibbin buyer review v1',`Audience: ${url.origin}`,`Subject: ${subject}`,'Chain: 97',`Commerce: ${CONTRACTS[97].commerceProxy.toLowerCase()}`,'Job: 1179',`Buyer: ${buyer.toLowerCase()}`,'Rating: 5/5',`Comment: ${JSON.stringify(body.comment)}`,`Nonce: ${nonce}`,`Issued at: ${issuedAt}`,`Expires at: ${expiresAt}`,'Public review. No transaction or spending approval.'].join('\n');
          return json({id:'test-challenge-1179',nonce,issuedAt,expiresAt,message});
        }
        if(body.action === 'publish') {
          publishedReview={id:'1',subject,chainId:97,jobId:'1179',buyer:buyer.toLowerCase(),rating:5,comment:reviewInput.comment,createdAt:new Date().toISOString()};
          return json({review:publishedReview,replayed:false});
        }
      }
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort();
    });
    try {
      await page.goto(`${base}/try/?job=1179`);
      await page.getByLabel('Existing job ID').waitFor();
      assert.deepEqual(await page.evaluate(()=>window.testWalletCalls), [], 'Loading must not request wallet access');
      await page.getByRole('button',{name:'Connect wallet',exact:true}).click();
      await page.getByRole('button',{name:'Load job from chain'}).click();
      await page.getByText(`Job #1179 · ${status === 3 ? 'Completed' : 'Submitted'}`,{exact:true}).waitFor();
      assert.deepEqual((await page.evaluate(()=>window.testWalletCalls)).map(x=>x.method),['eth_requestAccounts','eth_chainId']);
      const review = page.getByRole('region',{name:'Review completed job'});
      if(status === 2) {assert.equal(await review.count(),0); console.log('PASS Submitted has no review or automatic signing');continue;}
      await review.waitFor();
      assert.equal(await page.getByLabel('Collateral value',{exact:true}).isVisible(),false,'Completed jobs do not repeat the setup editor');
      assert.equal(await page.getByRole('checkbox').count(),0,'Completed jobs do not ask for transaction approval again');
      assert.equal(await page.getByText('On-chain deliverable digest',{exact:true}).isVisible(),false,'Delivery internals start collapsed');
      assert.equal(await page.getByRole('button',{name:'Leave a review'}).isEnabled(),true);
      assert.equal(await page.evaluate(()=>{const section=document.querySelector('[aria-label="Review completed job"]');const digest=[...document.querySelectorAll('p')].find(el=>el.textContent==='On-chain deliverable digest');return !!(digest.compareDocumentPosition(section)&Node.DOCUMENT_POSITION_FOLLOWING);}),true,'Review must appear after delivery');
      await page.getByRole('button',{name:'Disconnect',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Leave a review'}).isDisabled(),true);
      await page.getByRole('button',{name:'Connect wallet',exact:true}).click();
      await page.getByRole('button',{name:'Leave a review'}).click();
      await page.getByRole('radio',{name:'5 out of 5 stars'}).check();
      await page.getByLabel('Comment (optional)').fill('Synthetic browser test only.');
      await page.getByRole('button',{name:'Preview review',exact:true}).click();
      await page.getByRole('button',{name:'Sign and publish review',exact:true}).waitFor();
      assert.equal(await page.getByLabel('Comment (optional)').isVisible(),false,'Confirmation must not repeat the editable form');
      const technical=review.locator('details');
      assert.equal(await technical.count(),1,'Full signing text remains available as optional detail');
      assert.equal(await technical.evaluate(el=>el.open),false,'Technical signing payload starts collapsed');
      await page.getByRole('button',{name:'Edit review',exact:true}).click();
      assert.equal(await page.getByLabel('Comment (optional)').inputValue(),'Synthetic browser test only.','Editing retains the draft');
      assert.equal(await page.getByRole('radio',{name:'5 out of 5 stars'}).isChecked(),true);
      await page.getByRole('button',{name:'Preview review',exact:true}).click();
      await page.getByRole('button',{name:'Sign and publish review',exact:true}).waitFor();
      assert.equal(posts.length,2);
      assert.equal((await page.evaluate(()=>window.testWalletCalls)).filter(x=>x.method==='personal_sign').length,0,'Preview must not sign');
      await page.getByRole('button',{name:'Sign and publish review',exact:true}).click();
      await page.getByText('Your testnet review is published. 5/5 · Job #1179',{exact:true}).waitFor();
      await page.getByRole('region',{name:'Buyer reviews',exact:true}).getByText('Synthetic browser test only.',{exact:true}).waitFor();
      assert.equal(await page.getByRole('heading',{name:'Testnet buyer reviews',exact:true}).count(),1,'Published testnet feedback is labelled once, not presented as mainnet reviews');
      const calls=await page.evaluate(()=>window.testWalletCalls);
      assert.equal(calls.filter(x=>x.method==='personal_sign').length,1);
      assert.equal(calls.some(x=>x.method==='eth_sendTransaction'),false);
      assert.deepEqual(posts.map(x=>x.action),['challenge','challenge','publish']);
      assert.deepEqual(posts[2],{action:'publish',challengeId:'test-challenge-1179',signature:fakeSignature});
      assert.deepEqual(pageErrors,[]);
      assert.deepEqual(unexpected,[]);
      console.log('PASS real connected → Completed resume → preview → one signature → publication; disconnected disabled; delivery ordering');
    } catch(error) { console.error('Visible alerts:',await page.getByRole('alert').allTextContents());console.error('API actions:',posts.map(x=>x.action),'wallet methods:',await page.evaluate(()=>window.testWalletCalls?.map(x=>x.method)),'page errors:',pageErrors,'blocked requests:',unexpected);throw error; }
    finally {await context.close();}
  }
} finally {await browser.close();}
