import { Button, Label, SearchField as HeroSearchField } from "@heroui/react";

export function Basic({
  label = "Search",
  placeholder = "Search...",
  className = "w-[280px]",
  value,
  onChange,
  onSubmit,
  onClear,
  name = "search",
  showButton = true,
  buttonText = "Search",
  ...props
}) {
  return (
    <HeroSearchField
      name={name}
      value={value}
      onChange={onChange}
      onSubmit={onSubmit}
      onClear={onClear}
      aria-label={typeof label === "string" ? label : "Search"}
      {...props}
    >
      {label && <Label className="text-sm font-medium text-foreground block mb-1.5">{label}</Label>}
      <div className="flex items-center gap-2">
        <HeroSearchField.Group className="flex-1">
          <HeroSearchField.SearchIcon />
          <HeroSearchField.Input className={className} placeholder={placeholder} />
          <HeroSearchField.ClearButton />
        </HeroSearchField.Group>
        {showButton && (
          <Button variant="primary" onPress={() => onSubmit && onSubmit(value)}>
            {buttonText}
          </Button>
        )}
      </div>
    </HeroSearchField>
  );
}

export default Basic;
