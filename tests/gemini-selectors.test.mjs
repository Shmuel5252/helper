import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imageTool,videoTool} from '../scripts/gemini-worker/selectors.mjs';
test('Gemini Hebrew tool labels tolerate directional controls and plural labels',()=>{
 for(const label of ['יצירת תמונה','\u202bיצירת תמונה\u202c','יצירת תמונות','Create image'])assert(imageTool.test(label));
 for(const label of ['יצירת סרטון','\u202bיצירת סרטון\u202c','Create video'])assert(videoTool.test(label));
 assert(!imageTool.test('הוספה מ-Drive'));
});
