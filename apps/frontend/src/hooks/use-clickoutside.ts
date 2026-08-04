import { RefObject, useEffect } from "react";

type EventType = MouseEvent | TouchEvent;

// Using a generic <T> makes the hook compatible with any specific HTML element ref (e.g., HTMLDivElement)
const useClickOutside = <T extends HTMLElement = HTMLElement>(
  ref: RefObject<T | null>,
  handler: (event: EventType) => void,
) => {
  useEffect(() => {
    let startedInside = false;
    let startedWhenMounted = false;

    const listener = (event: EventType) => {
      // Do nothing if `mousedown` or `touchstart` started inside ref element
      if (startedInside || !startedWhenMounted) return;

      // event.target needs to be cast to Node for the contains() method to accept it
      if (!ref.current || ref.current.contains(event.target as Node)) return;

      handler(event);
    };

    const validateEventStart = (event: EventType) => {
      // !! coerces the element/null into a strict boolean
      startedWhenMounted = !!ref.current;
      startedInside = !!(
        ref.current && ref.current.contains(event.target as Node)
      );
    };

    document.addEventListener("mousedown", validateEventStart);
    document.addEventListener("touchstart", validateEventStart);
    document.addEventListener("click", listener);

    return () => {
      document.removeEventListener("mousedown", validateEventStart);
      document.removeEventListener("touchstart", validateEventStart);
      document.removeEventListener("click", listener);
    };
  }, [ref, handler]);
};

export default useClickOutside;
