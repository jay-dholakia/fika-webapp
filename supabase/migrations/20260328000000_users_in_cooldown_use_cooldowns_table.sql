-- Fix users_in_cooldown to use the correct table name: cooldowns (not matcha_cooldowns)
CREATE OR REPLACE FUNCTION public.users_in_cooldown(user_a_uuid uuid, user_b_uuid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  ordered_a UUID;
  ordered_b UUID;
BEGIN
  -- Ensure consistent ordering
  IF user_a_uuid < user_b_uuid THEN
    ordered_a := user_a_uuid;
    ordered_b := user_b_uuid;
  ELSE
    ordered_a := user_b_uuid;
    ordered_b := user_a_uuid;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM cooldowns
    WHERE user_a = ordered_a
      AND user_b = ordered_b
      AND cooldown_until > NOW()
  );
END;
$function$;
