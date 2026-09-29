(function () {
  function bind(root) {
    var dropdown = root.querySelector("[data-rg-rating-dropdown]");
    if (!dropdown || dropdown.dataset.bound === "true") return;
    dropdown.dataset.bound = "true";
    dropdown.addEventListener("change", function () {
      var button = root.querySelector(
        '[data-rg-rating-filter="' + dropdown.value + '"]',
      );
      if (button) button.click();
    });
  }

  function scan() {
    document.querySelectorAll("[data-rg-reviews-display]").forEach(bind);
  }

  scan();
  new MutationObserver(scan).observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
