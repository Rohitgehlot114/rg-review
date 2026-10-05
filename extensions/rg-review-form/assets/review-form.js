(function () {
  function clearErrors(form) {
    form.querySelectorAll("[data-error-for]").forEach(function (el) {
      el.hidden = true;
      el.textContent = "";
    });
  }

  function showError(form, field, message) {
    var el = form.querySelector('[data-error-for="' + field + '"]');
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
  }

  function clientValidate(form) {
    var errors = {};
    var rating = form.querySelector('input[name="rating"]:checked');
    var title = (form.elements.title.value || "").trim();
    var body = (form.elements.body.value || "").trim();

    if (!rating) {
      errors.rating = "Please select a rating from 1 to 5 stars.";
    }

    if (title.length > 120) {
      errors.title = "Title must be 120 characters or fewer.";
    }

    if (!body) {
      errors.body = "Review text is required.";
    } else if (body.length < 10) {
      errors.body = "Review text must be at least 10 characters.";
    } else if (body.length > 5000) {
      errors.body = "Review text must be 5000 characters or fewer.";
    }

    return errors;
  }

  function handleSubmit(event) {
    var form = event.currentTarget;
    var root = form.closest("[data-rg-review-root]");
    if (!root || !form) return;

    event.preventDefault();
    clearErrors(form);

    var clientErrors = clientValidate(form);
    var keys = Object.keys(clientErrors);
    if (keys.length) {
      keys.forEach(function (key) {
        showError(form, key, clientErrors[key]);
      });
      return;
    }

    var submitButton = form.querySelector("[data-rg-review-submit]");
    if (submitButton) {
      submitButton.disabled = true;
    }

    var formData = new FormData(form);

    fetch(form.action, {
      method: "POST",
      body: formData,
      headers: {
        Accept: "application/json",
      },
      credentials: "same-origin",
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, status: response.status, data: data };
        });
      })
      .then(function (result) {
        if (result.data && result.data.ok) {
          var success = root.querySelector("[data-rg-review-success]");
          if (success) {
            success.hidden = false;
            if (result.data.message) {
              success.textContent = result.data.message;
            }
          }
          form.reset();
          form.hidden = true;
          document.dispatchEvent(
            new CustomEvent("rg-review:submitted", {
              detail: { review: result.data.review || null },
            }),
          );
          var reviews = document.querySelector("[data-rg-reviews-display]");
          if (reviews) {
            reviews.scrollIntoView({ behavior: "smooth", block: "start" });
          }
          return;
        }

        var payload = result.data || {};
        if (payload.errors) {
          Object.keys(payload.errors).forEach(function (key) {
            showError(form, key, payload.errors[key]);
          });
        }
        showError(
          form,
          "form",
          payload.error || "Unable to submit your review. Please try again.",
        );
      })
      .catch(function () {
        showError(
          form,
          "form",
          "Unable to submit your review right now. Please try again.",
        );
      })
      .finally(function () {
        if (submitButton) {
          submitButton.disabled = false;
        }
      });
  }

  function bindForms(scope) {
    (scope || document)
      .querySelectorAll("[data-rg-review-form]")
      .forEach(function (form) {
        if (form.dataset.rgBound === "true") return;
        form.dataset.rgBound = "true";
        form.addEventListener("submit", handleSubmit);
      });
  }

  function bindRoot(root) {
    if (!root || root.dataset.rgModalBound === "true") return;
    root.dataset.rgModalBound = "true";
    var modal = root.querySelector("[data-rg-review-modal]");
    var form = root.querySelector("[data-rg-review-form]");
    if (!modal || !form) return;

    function open() {
      if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
      }
      modal.hidden = false;
      document.body.classList.add("rg-review-modal-open");
      var first = modal.querySelector('input[name="rating"]');
      if (first) first.focus();
    }

    function close() {
      modal.hidden = true;
      document.body.classList.remove("rg-review-modal-open");
      if (modal.parentElement === document.body) {
        root.appendChild(modal);
      }
    }

    root.querySelectorAll("[data-rg-review-trigger]").forEach(function (button) {
      button.addEventListener("click", open);
    });
    document.querySelectorAll("[data-rg-review-open]").forEach(function (button) {
      button.addEventListener("click", open);
    });
    document.addEventListener("rg-review:open", open);
    root.querySelectorAll("[data-rg-review-close]").forEach(function (button) {
      button.addEventListener("click", close);
    });
    modal.addEventListener("click", function (event) {
      if (event.target === modal) close();
    });
  }

  function showRedirectSuccess(root) {
    var params = new URLSearchParams(window.location.search);
    if (params.get("rg_review_status") !== "success") return;

    var success = root.querySelector("[data-rg-review-success]");
    var form = root.querySelector("[data-rg-review-form]");
    var modal = root.querySelector("[data-rg-review-modal]");
    if (success) success.hidden = false;
    if (form) form.hidden = true;
    if (modal) {
      if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
      }
      modal.hidden = false;
      document.body.classList.add("rg-review-modal-open");
    }

    params.delete("rg_review_status");
    var cleanUrl =
      window.location.pathname +
      (params.toString() ? "?" + params.toString() : "") +
      window.location.hash;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  function bindAll(scope) {
    (scope || document)
      .querySelectorAll("[data-rg-review-root]")
      .forEach(function (root) {
        bindForms(root);
        bindRoot(root);
        showRedirectSuccess(root);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      bindAll(document);
    });
  } else {
    bindAll(document);
  }

  document.addEventListener("shopify:section:load", function (event) {
    bindAll(event.target);
  });
})();
