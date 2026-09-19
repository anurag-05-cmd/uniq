package com.cedarqueue;

import java.util.*;

final class Dtos {
    static Map<String,Object> map(Object... values) { var out=new LinkedHashMap<String,Object>();for(int i=0;i<values.length;i+=2) out.put((String)values[i],values[i+1]);return out; }
    static Map<String,Object> user(Account a) { return map("id",a.id,"email",a.email,"displayName",a.displayName,"role",a.role); }
    static Map<String,Object> table(RestaurantTable t,Store s) { return map("id",t.id,"number",t.number,"areaId",t.areaId,"areaName",s.get(DiningArea.class,t.areaId).name,"capacity",t.capacity,"accessible",t.accessible,"status",t.status,"enabled",t.enabled,"version",t.version); }
    static Map<String,Object> entry(WaitlistEntry e,Policy policy,Store s,boolean staff) {
        RestaurantTable table=e.tableId==null?null:s.get(RestaurantTable.class,e.tableId);
        var out=map("id",e.id,"token",e.token,"partySize",e.partySize,"preference",e.preference,"accessible",e.accessible,"status",e.status,"joinedAt",e.joinedAt,"fairnessSince",e.fairnessSince,"checkedInAt",e.checkedInAt,"arrivalWindowOpenedAt",e.arrivalWindowOpenedAt,"arrivalDeadline",e.arrivalDeadline,"callDeadline",e.callDeadline,"snoozeReleaseAt",e.snoozeReleaseAt,"snoozeCount",e.snoozeCount,"snoozesRemaining",Math.max(0,policy.maxSnoozes()-e.snoozeCount),"priority",e.priority,"tableId",e.tableId,"tableNumber",table==null?null:table.number,"areaName",table==null?null:s.get(DiningArea.class,table.areaId).name,"etaSeconds",e.etaSeconds,"estimatedStartAt",e.estimatedStartAt,"computedAt",e.computedAt,"estimateSource",e.estimateSource,"sampleCount",e.sampleCount,"confidence",e.confidence,"assumesArrival",e.assumesArrival,"position",e.position,"version",e.version,"terminalReason",e.terminalReason);
        if(staff) out.put("customerName",s.get(Account.class,e.customerId).displayName);
        return out;
    }
    static Map<String,Object> visit(DiningVisit v,Store s) { return map("id",v.id,"entryId",v.entryId,"token",s.get(WaitlistEntry.class,v.entryId).token,"tableId",v.tableId,"tableNumber",s.get(RestaurantTable.class,v.tableId).number,"partySize",v.partySize,"startedAt",v.startedAt,"completedAt",v.completedAt,"durationSeconds",v.durationSeconds); }
    static Map<String,Object> notification(Notification n) { return map("id",n.id,"kind",n.kind,"title",n.title,"body",n.body,"createdAt",n.createdAt,"readAt",n.readAt); }
}
