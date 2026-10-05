window.ShopifyReviewForm = function mountReviewForm(panel, root, close) {
  const PATH = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z';
  const labels = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
  const form = document.createElement('form');
  form.className = 'sr-form';
  form.noValidate = true;
  form.innerHTML = `<div class="sr-form__head"><div><h3>Write a review</h3><p></p></div><button type="button" class="sr-close" aria-label="Close">×</button></div>
    <fieldset class="sr-field"><legend>Your rating <span aria-hidden="true">*</span></legend>
      <div class="sr-picker-wrap"><div class="sr-picker"></div><span class="sr-picker-text">Select a rating</span></div>
      <div class="sr-err" data-rating-error hidden>Please choose a star rating.</div>
    </fieldset>
    <div class="sr-field"><label>Review title <span class="opt">(optional)</span></label><input class="sr-input" name="title" maxlength="100" placeholder="Sum it up in a few words"></div>
    <div class="sr-field"><label>Your review</label><textarea class="sr-input" name="body" maxlength="5000" required placeholder="What did you like or dislike?"></textarea><div class="sr-hint"><span>Minimum 10 characters</span><span data-count>0 / 5000</span></div><div class="sr-err" data-body-error hidden>Please write at least 10 characters.</div></div>
    <div class="sr-field"><label>Display name</label><input class="sr-input" name="displayName" maxlength="60" required autocomplete="name" placeholder="e.g. Ankit S."></div>
    <div class="sr-hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
    <div class="sr-form__foot"><p class="sr-form__note">Reviews are checked before they appear.</p><button class="sr-btn" type="submit"></button></div>`;
  form.querySelector('p').textContent = root.dataset.productTitle || '';
  const productTitle = document.createElement('input');
  productTitle.type = 'hidden';
  productTitle.name = 'productTitle';
  productTitle.value = root.dataset.productTitle || '';
  form.append(productTitle);
  form.querySelector('[type="submit"]').textContent = root.dataset.submit || 'Submit review';
  const picker = form.querySelector('.sr-picker');
  for (let star = 5; star >= 1; star -= 1) {
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'rating';
    input.id = `${root.id}-rating-${star}`;
    input.value = String(star);
    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.title = labels[star];
    label.innerHTML = `<svg viewBox="0 0 24 24"><path d="${PATH}"/></svg><span class="sr-hp">${star} stars, ${labels[star]}</span>`;
    input.addEventListener('change', () => {
      form.querySelector('.sr-picker-text').textContent = labels[star];
      form.querySelector('[data-rating-error]').hidden = true;
    });
    picker.append(input, label);
  }
  const body = form.querySelector('[name="body"]');
  body.addEventListener('input', () => {
    form.querySelector('[data-count]').textContent = `${body.value.length} / 5000`;
  });
  form.querySelector('.sr-close').addEventListener('click', close);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const rating = form.querySelector('input[name="rating"]:checked');
    const ratingError = form.querySelector('[data-rating-error]');
    const bodyError = form.querySelector('[data-body-error]');
    ratingError.hidden = Boolean(rating);
    bodyError.hidden = body.value.trim().length >= 10;
    if (!rating || body.value.trim().length < 10 || !form.elements.displayName.value.trim()) return;
    const data = new FormData(form);
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Sending...';
    try {
      const response = await fetch(`/apps/rg-review/products/${root.dataset.productId}/reviews?shop=${encodeURIComponent(root.dataset.shop || '')}`, {method: 'POST', body: data});
      if (!response.ok) throw new Error('submit failed');
      form.replaceChildren();
      const success = document.createElement('div');
      success.className = 'sr-success';
      success.setAttribute('role', 'status');
      success.innerHTML = '<div class="tick"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0f7b4b" stroke-width="2.5"><path d="m5 12 5 5 9-10"/></svg></div><h3>Thank you for your review!</h3><p>Your review is now visible on this product.</p>';
      form.append(success);
    } catch {
      submit.disabled = false;
      submit.textContent = root.dataset.submit || 'Submit review';
      bodyError.hidden = false;
      bodyError.textContent = 'The review could not be sent. Please try again.';
    }
  });
  panel.replaceChildren(form);
  form.querySelector('input[name="rating"]')?.focus();
};
