"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker, DropdownProps } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center",
        caption_label: "hidden", // Hide default and use custom dropdowns
        caption_dropdowns: "flex gap-2",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse mt-4",
        head_row: "flex justify-items-center",
        head_cell: "w-9 font-normal text-sm text-muted-foreground flex-1",
        row: "flex w-full mt-2",
        cell: "h-9 w-9 text-center text-sm p-0 relative flex-1",
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal rounded-full transition-colors flex items-center justify-center"
        ),
        day_selected:
          "bg-primary text-primary-foreground rounded-full hover:bg-primary/90 focus:bg-primary/90",
        day_today: "bg-accent text-accent-foreground rounded-full",
        day_outside: "text-muted-foreground opacity-50",
        day_disabled: "text-muted-foreground opacity-50",
        day_range_middle:
          "aria-selected:bg-accent aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        Nav: ({ previousMonth, nextMonth, onPreviousClick, onNextClick }) => (
          <div className="flex items-center justify-between w-full px-2">
            <button
              onClick={onPreviousClick}
              disabled={!previousMonth}
              className="h-7 w-7 flex items-center justify-center opacity-50 hover:opacity-100"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
    
            <button
              onClick={onNextClick}
              disabled={!nextMonth}
              className="h-7 w-7 flex items-center justify-center opacity-50 hover:opacity-100"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ),
    
        Dropdown: ({ value, onChange, children }: DropdownProps & { children?: React.ReactNode }) => {
          const options = React.Children.toArray(children) as React.ReactElement<
            React.HTMLProps<HTMLOptionElement>
          >[];
        
          const selected = options.find(
            (child) => child.props.value?.toString() === value?.toString()
          );
        
          const handleChange = (newValue: string) => {
            const changeEvent = {
              target: { value: newValue },
            } as React.ChangeEvent<HTMLSelectElement>;
            onChange?.(changeEvent);
          };
        
          return (
            <Select
              value={value?.toString() ?? ""}
              onValueChange={(newValue) => handleChange(newValue)}
            >
              <SelectTrigger className="h-8 text-xs font-medium">
                <SelectValue>{selected?.props?.children}</SelectValue>
              </SelectTrigger>
        
              <SelectContent className="max-h-60">
                {options.map((option) => (
                  <SelectItem
                    key={option.props.value?.toString()}
                    value={option.props.value?.toString() ?? ""}
                  >
                    {option.props.children}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        },
      }}
      {...props}
    />
  )
}

Calendar.displayName = "Calendar"

export { Calendar }
