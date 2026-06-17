update profiles
set gender = lower(gender)
where gender is not null
  and gender != lower(gender);
