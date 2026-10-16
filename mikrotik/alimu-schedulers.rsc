/system scheduler remove [find name="t1"]
/system scheduler remove [find name="t4"]
/system scheduler remove [find name="alimu-provision"]
/system scheduler remove [find name="alimu-expire"]
/system scheduler remove [find name="alimu-kicker"]
/system scheduler remove [find name="alimu-data-exhausted"]
/system scheduler add name="alimu-provision" interval=15s on-event="/system script run alimu-provision"
/system scheduler add name="alimu-expire" interval=1m on-event="/system script run alimu-expire"
/system scheduler add name="alimu-kicker" interval=3s on-event="/system script run alimu-kicker"
/system scheduler add name="alimu-data-exhausted" interval=1m on-event="/system script run alimu-data-exhausted"
