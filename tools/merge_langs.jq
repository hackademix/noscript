with_entries(
  .key as $k |
  .value as $v |
  ($en[0][$k].message // null) as $enMsg |
  ($tmp[0][$k].message // null) as $newMsg |
  if $v.message == $enMsg and $newMsg != null and $newMsg != $enMsg then
    .value.message = $newMsg
  else
    .
  end
)
