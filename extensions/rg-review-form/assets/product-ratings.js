(function () {
  var productCache = new Map();
  var summaryCache = new Map();

  function safeText(value) {
    return value == null ? "" : String(value);
  }

  function productHandle(href) {
    try {
      var url = new URL(href, window.location.origin);
      var match = url.pathname.match(/\/products\/([^/]+)/);
      return match ? decodeURIComponent(match[1]) : "";
    } catch (error) {
      return "";
    }
  }

  function stars(average) {
    var rounded = Math.max(0, Math.min(5, Math.round(Number(average) || 0)));
    return Array.from({ length: 5 }, function (_, index) {
      return index < rounded ? "filled" : "empty";
    });
  }

  function ratingElement(summary) {
    var link = document.createElement("a");
    link.className = "rg-product-rating";
    link.href = "#rg-review-reviews";
    link.setAttribute("aria-label", "Read customer reviews");

    var starsElement = document.createElement("span");
    starsElement.className = "rg-product-rating__stars";
    stars(summary.averageRating).forEach(function (state) {
      var star = document.createElement("span");
      star.className = "rg-product-rating__star rg-product-rating__star--" + state;
      star.appendChild(document.createTextNode("★"));
      starsElement.appendChild(star);
    });

    var count = document.createElement("span");
    count.className = "rg-product-rating__count";
    count.appendChild(
      document.createTextNode(
        summary.count === 1
          ? "1 Review"
          : safeText(summary.count) + " Reviews",
      ),
    );

    link.appendChild(starsElement);
    link.appendChild(count);
    link.addEventListener("click", function () {
      var reviews = document.querySelector("[data-rg-reviews-display]");
      if (reviews) {
        reviews.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    return link;
  }

  function cardFor(link) {
    return (
      link.closest("article") ||
      link.closest("[class*='card']") ||
      link.closest("li") ||
      link.parentElement
    );
  }

  function addRating(link) {
    if (link.dataset.rgRatingBound === "true") return;
    var handle = productHandle(link.href);
    if (!handle) return;
    var card = cardFor(link);
    if (!card || card.querySelector(".rg-product-rating")) return;

    link.dataset.rgRatingBound = "true";
    var productRequest = productCache.get(handle);
    if (!productRequest) {
      productRequest = fetch(
        "/products/" + encodeURIComponent(handle) + ".js",
        {
          headers: { Accept: "application/json" },
          credentials: "same-origin",
        },
      ).then(function (response) {
        if (!response.ok) throw new Error("product");
        return response.json();
      });
      productCache.set(handle, productRequest);
    }
    productRequest
      .then(function (product) {
        if (!product || !product.id) throw new Error("product");
        var productId = String(product.id);
        var summaryRequest = summaryCache.get(productId);
        if (!summaryRequest) {
          summaryRequest = fetch(
            "/apps/rg-review/reviews?product_id=" +
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
            .catch(function (error) {
              summaryCache.delete(productId);
              throw error;
            });
          summaryCache.set(productId, summaryRequest);
        }
        return summaryRequest;
      })
      .then(function (summary) {
        if (!card || card.querySelector(".rg-product-rating")) return;
        var rating = ratingElement(summary);
        var title = card.querySelector(
          "[class*='title'], [class*='product-name'], h2, h3",
        );
        if (title && title.parentElement) {
          title.parentElement.appendChild(rating);
        } else {
          card.appendChild(rating);
        }
      })
      .catch(function () {
        link.dataset.rgRatingBound = "false";
      });
  }

  function scan(scope) {
    (scope || document)
      .querySelectorAll('a[href*="/products/"]')
      .forEach(addRating);
  }

  function addProductReviewButton() {
    if (!window.location.pathname.match(/\/products\/[^/]+/)) return;
    if (document.querySelector(".rg-product-review-button")) return;

    var price =
      document.querySelector("main [class*='price']") ||
      document.querySelector("[role='main'] [class*='price']") ||
      document.querySelector("[class*='product'] [class*='price']");
    if (!price || !price.parentElement) return;

    var button = document.createElement("button");
    button.type = "button";
    button.className = "rg-product-rating rg-product-review-button";
    button.appendChild(document.createTextNode("Write a Review"));
    button.addEventListener("click", function () {
      document.dispatchEvent(new CustomEvent("rg-review:open"));
      var reviews = document.querySelector("[data-rg-reviews-display]");
      if (reviews) {
        reviews.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    price.parentElement.appendChild(button);
    document
      .querySelectorAll(".rg-reviews-display__write")
      .forEach(function (fallback) {
        fallback.remove();
      });
  }

  function bind() {
    scan(document);
    addProductReviewButton();
    if (!window.__rgReviewRatingObserver) {
      window.__rgReviewRatingObserver = new MutationObserver(function () {
        if (window.__rgRatingScanScheduled) return;
        window.__rgRatingScanScheduled = true;
        window.setTimeout(function () {
          window.__rgRatingScanScheduled = false;
          scan(document);
          addProductReviewButton();
        }, 120);
      });
      window.__rgReviewRatingObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
