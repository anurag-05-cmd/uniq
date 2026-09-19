package com.cedarqueue;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class CedarQueueApplication {
    public static void main(String[] args) { SpringApplication.run(CedarQueueApplication.class, args); }
}
