import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generationUnavailable} from '../scripts/gemini-worker/response.mjs';

test('stops waiting on explicit Hebrew capability refusals',()=>{
  for(const text of [
    'לצערי, כמודל שפה אין לי אפשרות טכנית לייצר או להנפיש סרטוני וידאו.',
    'כמודל בינה מלאכותית מבוסס טקסט, אין לי אפשרות ליצור, לערוך או להפיק וידאו בפועל.',
    'אין לי יכולת ליצור סרטון.',
    'אין לי אפשרות לעזור לך במקרה הזה, כי אני בסך הכל מודל שפה ואין לי את היכולת להבין ולהגיב.',
    'אני מבוסס טקסט, ואין לי אפשרות לעזור לך במקרה הזה.',
    'I am just a language model.',
    'הגעת למכסה היומית. נסו שוב מחר.',
    'אני לא יכול/ה ליצור סרטונים שנראים כמציגים קטינים במצבים מסוכנים או מביכים. אפשר לעזור לך במשהו אחר?',
    'אני לא יכולה ליצור את הסרטון הזה. אפשר לנסות משהו אחר.',
    "I can't generate this video. Please try a different request.",
  ])assert.equal(generationUnavailable(text),true,text);
});

test('does not mistake unrelated limitations or pending generation for a refusal',()=>{
  for(const text of [
    'אני יוצר את הסרטון שלך עכשיו.',
    'אין לי אפשרות להבטיח את זמן ההמתנה המדויק.',
    'כמודל שפה אוכל לעזור. הסרטון נוצר כעת.',
    'הסרטון מוכן לצפייה.',
    'הרבה משתמשים יוצרים סרטונים כרגע. הסרטון שלך עדיין בעיבוד.',
  ])assert.equal(generationUnavailable(text),false,text);
});

test('ends waiting when the video service explicitly rejects new requests due to demand',()=>{
  for(const text of [
    'הרבה משתמשים ביקשו עכשיו ליצור סרטונים ולצערי אני לא יכול לקבל כרגע בקשות לסרטונים נוספים. אפשר לנסות שוב עוד מעט.',
    "I'm experiencing high demand and can't take any more video requests right now. Please try again later.",
  ])assert.equal(generationUnavailable(text),true,text);
});
