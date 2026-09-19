package com.cedarqueue;

import java.time.*;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Event simulation sharing the exact dispatch selector. Forecasts are conditional on arrival. */
public final class EtaEngine {
    public record Sample(int partySize,long seconds,Instant completedAt) {}
    public record Estimate(double meanSeconds,int count,String source,List<Long> durations) {}
    public record Pending(AllocationEngine.Party party,boolean remote,Instant releaseAt,Set<UUID> barriers) {}
    public record Slot(AllocationEngine.Table table,long busySeconds) {}
    public record Forecast(Long seconds,Instant start,String source,int samples,String confidence,boolean assumesArrival,int position) {}
    private static int category(int size) { return size<=2?2:size<=4?4:size<=6?6:8; }
    public Estimate duration(List<Sample> samples,int size,Policy policy,Instant now) {
        var recent=samples.stream().filter(s->s.seconds()>0 && !s.completedAt().isBefore(now.minusSeconds(policy.sampleHorizonMinutes()*60L)) && !s.completedAt().isAfter(now))
            .sorted(Comparator.comparing(Sample::completedAt).reversed()).toList();
        var matching=recent.stream().filter(s->category(s.partySize())==category(size)).limit(policy.sampleSize()).toList();
        if(matching.size()>=policy.minimumSamples()) return average(matching,"PARTY_SIZE_WINDOW");
        var pooled=recent.stream().limit(policy.sampleSize()).toList();
        if(pooled.size()>=policy.minimumSamples()) return average(pooled,"RESTAURANT_POOL");
        return new Estimate(policy.defaultDiningMinutes()*60.0,pooled.size(),"DEFAULT",pooled.stream().map(Sample::seconds).toList());
    }
    private Estimate average(List<Sample> samples,String source) { return new Estimate(samples.stream().mapToLong(Sample::seconds).average().orElseThrow(),samples.size(),source,samples.stream().map(Sample::seconds).toList()); }
    public long residual(Estimate estimate,long elapsed) {
        var longer=estimate.durations().stream().filter(s->s>elapsed).toList();
        if(longer.size()>=3) return Math.round(longer.stream().mapToLong(s->s-elapsed).average().orElseThrow());
        return Math.max(30,Math.round(estimate.meanSeconds()-elapsed));
    }
    public Map<UUID,Forecast> forecast(List<Pending> input,List<Slot> slots,List<Sample> samples,int initialBurst,Policy policy,Instant now) {
        var output=new LinkedHashMap<UUID,Forecast>();
        if(slots.isEmpty()) return output;
        var pending=new ArrayList<>(input);
        var available=new HashMap<UUID,Instant>();
        slots.forEach(s->available.put(s.table().id(),now.plusSeconds(s.busySeconds())));
        var released=new HashSet<UUID>(); var restored=new HashMap<UUID,Instant>();
        int burst=initialBurst,position=0,steps=0; boolean assumesArrival=false;
        Instant time=slots.stream().map(s->available.get(s.table().id())).min(Comparator.naturalOrder()).orElse(now);
        while(!pending.isEmpty() && steps++<input.size()*4+slots.size()*2+10) {
            final Instant at=time;
            var eligible=new ArrayList<AllocationEngine.Party>();
            for(var p:pending) {
                boolean snoozed=p.releaseAt()!=null;
                boolean ready=!snoozed || !p.releaseAt().isAfter(at) || released.containsAll(p.barriers());
                if(ready) {
                    var party=p.party();
                    if(snoozed) {
                        Instant release=restored.computeIfAbsent(party.id(),id->at);
                        party=new AllocationEngine.Party(party.id(),party.size(),party.accessible(),party.preference(),party.priority(),release,party.sequence());
                    }
                    eligible.add(party);
                }
            }
            var free=slots.stream().filter(s->!available.get(s.table().id()).isAfter(at)).map(Slot::table).toList();
            var choice=new AllocationEngine().select(eligible,free,burst,policy,at);
            if(choice.isPresent()) {
                var chosen=choice.get();var p=pending.stream().filter(x->x.party().id().equals(chosen.party().id())).findFirst().orElseThrow();
                var duration=duration(samples,p.party().size(),policy,now);
                assumesArrival|=p.remote();
                output.put(p.party().id(),new Forecast(Math.max(0,Duration.between(now,at).toSeconds()),at,duration.source(),duration.count(),duration.source().equals("DEFAULT")?"LOW":"MEDIUM",assumesArrival,++position));
                available.put(chosen.table().id(),at.plusSeconds(Math.round(duration.meanSeconds())));
                pending.remove(p);released.add(p.party().id());burst=p.party().priority()?Math.min(policy.priorityBurstLimit(),burst+1):0;
            } else {
                Instant next=available.values().stream().filter(t->t.isAfter(at)).min(Comparator.naturalOrder()).orElse(null);
                for(var p:pending) if(p.releaseAt()!=null && p.releaseAt().isAfter(at) && (next==null || p.releaseAt().isBefore(next))) next=p.releaseAt();
                if(next==null) break;
                time=next;
            }
        }
        return output;
    }
}
