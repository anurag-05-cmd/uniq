package com.cedarqueue;

import jakarta.validation.constraints.*;

public record Policy(
    @Min(1) @Max(120) int arrivalLeadMinutes,
    @Min(1) @Max(30) int arrivalGraceMinutes,
    @Min(1) @Max(10) int callGraceMinutes,
    @Min(0) @Max(2) int maxSnoozes,
    @Min(1) @Max(10) int snoozeMinutes,
    @Min(1) @Max(10) int snoozeSpots,
    @Min(1) @Max(2) int priorityBurstLimit,
    @Min(1) @Max(30) int agingMinutes,
    @Min(5) @Max(120) int starvationMinutes,
    @Min(5) @Max(100) int sampleSize,
    @Min(15) @Max(1440) int sampleHorizonMinutes,
    @Min(1) @Max(100) int minimumSamples,
    @Min(5) @Max(180) int defaultDiningMinutes,
    @Min(1) @Max(500) int maxActiveParties,
    @Min(0) @Max(30) int capacityWastePenalty) {
    static Policy defaults() { return new Policy(10,5,2,2,10,3,2,5,30,20,120,5,45,500,3); }
}
