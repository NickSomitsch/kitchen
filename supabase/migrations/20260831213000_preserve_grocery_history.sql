alter table public.grocery_items drop constraint grocery_items_check1;
alter table public.grocery_items drop constraint grocery_items_check2;

alter table public.grocery_items
  add constraint grocery_items_low_stock_link_check
  check (source = 'manual' or inventory_item_id is not null or status = 'purchased');

alter table public.grocery_items
  add constraint grocery_items_completion_check
  check (
    (status = 'active' and completed_at is null and completed_by is null and not stocked)
    or (status = 'purchased' and completed_at is not null)
  );
