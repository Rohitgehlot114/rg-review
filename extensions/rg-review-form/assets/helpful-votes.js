(function () {
  function controls(item) {
    if (item.dataset.helpfulBound === "true") return;
    var helpful = item.querySelector(".rg-reviews-display__helpful");
    var token = item.dataset.reviewToken;
    if (!helpful || !token) return;
    item.dataset.helpfulBound = "true";
    helpful.replaceChildren();
    helpful.appendChild(document.createTextNode("Was this review helpful? "));
    ["yes", "no"].forEach(function (choice) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "rg-reviews-display__vote";
      button.dataset.vote = choice;
      button.appendChild(
        document.createTextNode(choice === "yes" ? "Like" : "Unlike"),
      );
      button.addEventListener("click", function () {
        button.disabled = true;
        fetch("/apps/rg-review/reviews", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify({
            reviewToken: token,
            helpful: choice === "yes",
          }),
        })
          .then(function (response) {
            return response.json().then(function (data) {
              if (!response.ok || !data.ok) throw new Error("vote");
              return data;
            });
          })
          .then(function (data) {
            helpful.querySelectorAll(".rg-reviews-display__vote").forEach(
              function (vote) {
                vote.disabled = false;
                vote.classList.toggle(
                  "is-selected",
                  vote.dataset.vote === (data.viewerVote ? "yes" : "no"),
                );
              },
            );
            helpful.dataset.counts =
              " " + data.helpfulCount + " likes · " + data.unhelpfulCount + " unlikes";
          })
          .catch(function () {
            helpful.querySelectorAll(".rg-reviews-display__vote").forEach(
              function (vote) {
                vote.disabled = false;
              },
            );
          });
      });
      helpful.appendChild(button);
    });
    var counts = document.createElement("span");
    counts.className = "rg-reviews-display__vote-counts";
    counts.textContent =
      " " + (item.dataset.helpfulCount || "0") + " likes · " +
      (item.dataset.unhelpfulCount || "0") + " unlikes";
    helpful.appendChild(counts);
  }

  function scan() {
    document.querySelectorAll(".rg-reviews-display__item").forEach(controls);
  }

  scan();
  new MutationObserver(scan).observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
