(function () {
  function update(helpful, item) {
    var counts = helpful.dataset.counts || "";
    var match = counts.match(/(\d+)\s+likes\s+·\s+(\d+)\s+unlikes/);
    var likes = match ? match[1] : item.dataset.helpfulCount || "0";
    var unlikes = match ? match[2] : item.dataset.unhelpfulCount || "0";
    var buttons = helpful.querySelectorAll(".rg-reviews-display__vote");
    buttons.forEach(function (button) {
      button.textContent = button.dataset.vote === "yes" ? "👍 " + likes : "👎 " + unlikes;
    });
  }

  function scan() {
    document.querySelectorAll(".rg-reviews-display__item").forEach(function (item) {
      var helpful = item.querySelector(".rg-reviews-display__helpful");
      if (!helpful) return;
      update(helpful, item);
      helpful.querySelectorAll(".rg-reviews-display__vote").forEach(function (button) {
        if (button.dataset.layoutBound === "true") return;
        button.dataset.layoutBound = "true";
        button.addEventListener("click", function () {
          window.setTimeout(function () {
            update(helpful, item);
          }, 50);
        });
      });
    });
  }

  scan();
  new MutationObserver(scan).observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
