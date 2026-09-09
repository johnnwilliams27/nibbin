import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/components/card-row-heights.ts',import.meta.url),'utf8');
const exports={};
new Function('exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(exports);
const {rowBaseHeights}=exports;
test('natural collapsed heights equalize per row, never across rows',()=>{
 assert.deepEqual(rowBaseHeights([{top:0,height:250},{top:0,height:301.2},{top:400,height:270},{top:400,height:280}]),[302,302,280,280]);
});
test('expansion changes later row positions but never their collapsed base heights',()=>{
 assert.deepEqual(rowBaseHeights([{top:0,height:250},{top:0,height:300},{top:800,height:270},{top:800,height:280}]),[300,300,280,280]);
});
test('single column cards retain individual natural heights',()=>{
 assert.deepEqual(rowBaseHeights([{top:0,height:250},{top:400,height:300},{top:900,height:270}]),[250,300,270]);
});
