/**
 * Controls bar: dropdowns, mode toggle, upcoming-time input.
 * Emits a "controls:change" CustomEvent on the document whenever
 * the user changes any filter.
 */

export function initControls() {
  const eventType     = document.getElementById("eventType");
  const ccyPair       = document.getElementById("ccyPair");
  const volRegime     = document.getElementById("volRegime");
  const upcomingGroup = document.getElementById("upcomingTimeGroup");
  const upcomingTime  = document.getElementById("upcomingTime");
  const modeBtns      = document.querySelectorAll(".mode-btn");

  function currentState() {
    const activeMode = document.querySelector(".mode-btn.active")?.dataset.mode ?? "historical";
    return {
      eventType: eventType.value,
      ccyPair:   ccyPair.value,
      volRegime: volRegime.value,
      mode:      activeMode,
      upcomingTime: upcomingTime.value || null,
    };
  }

  function emit() {
    document.dispatchEvent(
      new CustomEvent("controls:change", { detail: currentState() })
    );
  }

  // Dropdowns
  [eventType, ccyPair, volRegime, upcomingTime].forEach((el) => {
    el.addEventListener("change", emit);
  });

  // Mode toggle
  modeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      modeBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      upcomingGroup.style.display = btn.dataset.mode === "upcoming" ? "" : "none";
      emit();
    });
  });

  // Fire initial state
  emit();

  return { currentState };
}
