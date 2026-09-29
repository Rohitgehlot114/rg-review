(function () {
  function render(container, summary) {
    var stars = container.querySelector(".rg-rating-show__stars");
    var count = container.querySelector(".rg-rating-show__count");
    var rounded = Math.max(
      0,
      Math.min(5, Math.round(Number(summary.averageRating) || 0)),
    );
    stars.replaceChildren();
    for (var index = 0; index < 5; index += 1) {
      var star = document.createElement("span");
      star.className =
        "rg-rating-show__star--" + (index < rounded ? "filled" : "empty");
      star.appendChild(document.createTextNode("★"));
      stars.appendChild(star);
    }
    stars.setAttribute(
      "aria-label",
      (Number(summary.averageRating) || 0).toFixed(1) + " out of 5 stars",
    );
    count.textContent =
      summary.count === 1 ? "1 Review" : String(summary.count || 0) + " Reviews";
  }

  function load(container) {
    var productId = container.getAttribute("data-product-id");
    var endpoint = container.getAttribute("data-endpoint");
    if (!productId || !endpoint || container.dataset.loaded === "true") return;
    container.dataset.loaded = "true";
    fetch(
      endpoint +
        "?product_id=" +
        encodeURIComponent(productId) +
        "&limit=1&offset=0",
      {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      },
    )
      .then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok || !data.ok) throw new Error("reviews");
          return data.summary || { count: 0, averageRating: null };
        });
      })
      .then(function (summary) {
        render(container, summary);
      })
      .catch(function () {
        container.querySelector(".rg-rating-show__count").textContent =
          "Reviews unavailable";
      });
  }

  function bind(scope) {
    (scope || document)
      .querySelectorAll("[data-rg-rating-show]")
      .forEach(load);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      bind(document);
    });
  } else {
    bind(document);
  }
  document.addEventListener("shopify:section:load", function (event) {
    bind(event.target);
  });
})();
