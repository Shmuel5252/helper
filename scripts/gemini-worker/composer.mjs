// The tool chip appears before Omni's video workspace finishes loading.
// Sending while only the chip exists can still reach the text model.
export async function waitForMediaComposer(page,kind){
  await page.getByRole('button',{name:kind==='video'?/ביטול הבחירה של סרטונים|Deselect videos/i:/ביטול הבחירה של תמונות|Deselect images/i}).waitFor({state:'visible',timeout:60000});
  if(kind==='video'){
    // Conversation titles can contain "Create videos" too. The aspect control
    // belongs to the actual video composer and supports either orientation.
    await page.getByRole('button',{name:/יחס גובה-רוחב|Aspect ratio/i}).waitFor({state:'visible',timeout:60000});
  }
}

export async function submitMedia(page,kind){
  // Uploads and editor changes happen after prepare. Fail closed if they lost
  // the selected tool; never fall back to sending into a plain text chat.
  await waitForMediaComposer(page,kind);
  await page.getByRole('button',{name:/^(שליחת הודעה|Send message|Send)$/i}).click({timeout:60000});
}
