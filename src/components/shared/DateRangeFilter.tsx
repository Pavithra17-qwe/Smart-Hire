'use client';

import { forwardRef, useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { format, parse, isValid } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Calendar as CalendarIcon } from 'lucide-react';

interface DateInputProps {
  value?: string;
  onClick?: () => void;
  placeholder?: string;
}

const DateInput = forwardRef<HTMLButtonElement, DateInputProps>(
  ({ value, onClick, placeholder }, ref) => (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      ref={ref}
      className="w-full justify-start font-normal gap-2"
    >
      <CalendarIcon className="h-4 w-4 text-muted-foreground" />
      {value || <span className="text-muted-foreground">{placeholder}</span>}
    </Button>
  )
);
DateInput.displayName = 'DateInput';

export function DateRangeFilter({
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
  onClear,
  showLabels = true,
  clearLabel = 'Clear Date Filter',
}: {
  fromDate: string;
  toDate: string;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  onClear: () => void;
  showLabels?: boolean;
  clearLabel?: string;
}) {
  const isActive = !!(fromDate || toDate);
  const [rangeError, setRangeError] = useState('');

  const parseStored = (val: string): Date | null => {
    if (!val) return null;
    const parsed = parse(val, 'dd-MM-yyyy', new Date());
    return isValid(parsed) ? parsed : null;
  };

  const fromDateObj = parseStored(fromDate);
  const toDateObj   = parseStored(toDate);

  const maxDate = new Date();

  const handleFromSelect = (date: Date | null) => {
    if (!date) { onFromDateChange(''); return; }
    setRangeError('');
    if (toDateObj && date > toDateObj) {
      setRangeError('To Date was cleared because it was earlier than the new From Date.');
      onToDateChange('');
    }
    onFromDateChange(format(date, 'dd-MM-yyyy'));
  };

  const handleToSelect = (date: Date | null) => {
    if (!date) { onToDateChange(''); return; }
    if (fromDateObj && date < fromDateObj) {
      setRangeError('To Date cannot be earlier than From Date.');
      return;
    }
    setRangeError('');
    onToDateChange(format(date, 'dd-MM-yyyy'));
  };

  const handleClear = () => {
    setRangeError('');
    onClear();
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
        <div className="space-y-1">
          {showLabels && <Label htmlFor="from-date">From Date</Label>}
          <DatePicker
            id="from-date"
            selected={fromDateObj}
            onChange={handleFromSelect}
            maxDate={maxDate}
            dateFormat="dd-MM-yyyy"
            todayButton="Today"
            showMonthDropdown
            showYearDropdown
            dropdownMode="select"
            placeholderText="dd-mm-yyyy"
            customInput={<DateInput placeholder="dd-mm-yyyy" />}
          />
        </div>

        <div className="space-y-1">
          {showLabels && <Label htmlFor="to-date">To Date</Label>}
          <DatePicker
            id="to-date"
            selected={toDateObj}
            onChange={handleToSelect}
            minDate={fromDateObj || undefined}
            maxDate={maxDate}
            dateFormat="dd-MM-yyyy"
            todayButton="Today"
            showMonthDropdown
            showYearDropdown
            dropdownMode="select"
            placeholderText="dd-mm-yyyy"
            customInput={<DateInput placeholder="dd-mm-yyyy" />}
          />
        </div>

        <div className="flex h-full items-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={!isActive}
            className="w-full"
          >
            {clearLabel}
          </Button>
        </div>
      </div>

      {rangeError && <p className="text-xs text-red-500">{rangeError}</p>}
    </div>
  );
}