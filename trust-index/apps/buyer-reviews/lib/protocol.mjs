import { isAddress } from 'viem';
export const SUBJECT = 'reference:97:health-factor';
export const COMMERCE = '0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de';
export const ROUTER = '0xd7d36d66d2f1b608a0f943f722d27e3744f66f25';
export const PROVIDER = '0x6f736f824b27f686e6cc5dbd945f9727812a1c72';
export class ReviewError extends Error { constructor(status,message) {super(message);this.status=status;} }
export function requireThat(value,message,status=400) {if(!value) throw new ReviewError(status,message);}
export function strictObject(value,keys) {requireThat(value && typeof value==='object' && !Array.isArray(value),'Expected an object');requireThat(Object.keys(value).every(k=>keys.includes(k)),'Unexpected request field');}
export function decimal(value,name='job ID') {requireThat(typeof value==='string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value)<2n**256n,`Invalid ${name}`);return value;}
export function subject(value) {requireThat(typeof value==='string' && value.length<=120 && (value===SUBJECT || /^erc8004:[1-9][0-9]{0,9}:(0|[1-9][0-9]{0,77})$/.test(value)),'Invalid subject');return value;}
export function parseReview(value) {
 strictObject(value,['subject','jobId','buyer','rating','comment']);subject(value.subject);requireThat(value.subject===SUBJECT,'Reviews are not enabled for this subject',403);
 decimal(value.jobId);requireThat(typeof value.buyer==='string' && isAddress(value.buyer,{strict:false}) && !/^0x0{40}$/i.test(value.buyer),'Invalid buyer');
 requireThat(Number.isInteger(value.rating)&&value.rating>=1&&value.rating<=5,'Rating must be an integer from 1 to 5');
 const comment=value.comment??'';requireThat(typeof comment==='string'&&comment.length<=1000&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(comment),'Comment must be plain text up to 1,000 characters without control characters');
 return {...value,buyer:value.buyer.toLowerCase(),comment,chainId:97,commerce:COMMERCE};
}
export function reviewMessage(c,audience) {return ['Nibbin buyer review v1',`Audience: ${audience}`,`Subject: ${c.subject}`,'Chain: 97',`Commerce: ${COMMERCE}`,`Job: ${c.jobId}`,`Buyer: ${c.buyer}`,`Rating: ${c.rating}/5`,`Comment: ${JSON.stringify(c.comment)}`,`Nonce: ${c.nonce}`,`Issued at: ${c.issuedAt}`,`Expires at: ${c.expiresAt}`,'Public review. No transaction or spending approval.'].join('\n');}
export function publicReview(r) {return {id:String(r.id),subject:r.subject,chainId:r.chainId,jobId:r.jobId,buyer:r.buyer,rating:r.rating,comment:r.comment,createdAt:r.createdAt};}
