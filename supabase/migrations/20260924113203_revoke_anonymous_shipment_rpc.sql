-- The project grants new public-schema functions EXECUTE to anon by default.
-- Apply after atomic_shipment_pallet on projects that installed it earlier.
revoke all on function public.load_pallet_into_shipment(uuid,text,text) from anon;
