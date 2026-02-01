import * as React from "react";

interface UseControlledStateProps<T> {
  value?: T;
  defaultValue: T;
  onChange?: (value: T) => void;
}

export function useControlledState<T>({
  value,
  defaultValue,
  onChange,
}: UseControlledStateProps<T>): [T, (next: T) => void] {
  const [state, setInternalState] = React.useState<T>(
    value !== undefined ? value : defaultValue,
  );

  React.useEffect(() => {
    if (value !== undefined) setInternalState(value);
  }, [value]);

  const setState = React.useCallback(
    (next: T) => {
      setInternalState(next);
      onChange?.(next);
    },
    [onChange],
  );

  return [state, setState];
}
