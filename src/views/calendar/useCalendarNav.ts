import { useState, useCallback } from "react";

export type CalendarViewType = "dayGridMonth" | "timeGridWeek" | "timeGridDay";

export function useCalendarNav() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewType, setViewType] = useState<CalendarViewType>("dayGridMonth");

  const goToToday = useCallback(() => setCurrentDate(new Date()), []);

  const goNext = useCallback(() => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (viewType === "dayGridMonth") d.setMonth(d.getMonth() + 1);
      else if (viewType === "timeGridWeek") d.setDate(d.getDate() + 7);
      else d.setDate(d.getDate() + 1);
      return d;
    });
  }, [viewType]);

  const goPrev = useCallback(() => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (viewType === "dayGridMonth") d.setMonth(d.getMonth() - 1);
      else if (viewType === "timeGridWeek") d.setDate(d.getDate() - 7);
      else d.setDate(d.getDate() - 1);
      return d;
    });
  }, [viewType]);

  return { currentDate, setCurrentDate, viewType, setViewType, goToToday, goNext, goPrev };
}
