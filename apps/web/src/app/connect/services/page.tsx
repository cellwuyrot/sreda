"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";

interface Service {
  id: string;
  title: string;
  description: string;
  icon: string | null;
  order: number;
}

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);

  useEffect(() => {
    fetch("/api/services").then((r) => r.json()).then(setServices);
  }, []);

  return (
    <div className="min-h-screen bg-[var(--background)] transition-colors duration-300 py-12 px-4">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-fantasy-gold/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-cyan-400/5 rounded-full blur-[120px]" />
      </div>

      <div className="max-w-6xl mx-auto relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-16"
        >
          <Link href="/connect" className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 mb-4 text-sm transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Назад к TZ.Connect
          </Link>
          <h1 className="section-title text-4xl md:text-5xl mb-4">IT-услуги для бизнеса</h1>
          <p className="text-neutral-500 dark:text-gray-400 max-w-2xl mx-auto text-lg">
            Комплексные решения от команды TrioZ для автоматизации, интеграции и развития вашего бизнеса
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {services.map((service, i) => (
            <motion.div
              key={service.id}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.6 }}
              onClick={() => setSelectedService(service)}
              className="glass-card-hover p-6 cursor-pointer group"
            >
              <div className="text-3xl mb-4 group-hover:scale-110 transition-transform duration-300">
                {service.icon || "🔹"}
              </div>
              <h3 className="text-lg font-bold text-neutral-900 dark:text-white mb-2 group-hover:text-cyan-400 transition-colors">
                {service.title}
              </h3>
              <p className="text-neutral-500 dark:text-gray-400 text-sm leading-relaxed">{service.description}</p>
            </motion.div>
          ))}
        </div>

        {selectedService && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setSelectedService(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="glass-card p-8 max-w-lg w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-4xl mb-4">{selectedService.icon}</div>
              <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-3">{selectedService.title}</h2>
              <p className="text-neutral-700 dark:text-gray-300 leading-relaxed mb-6">{selectedService.description}</p>
              <div className="flex gap-3">
                <Link href="/connect" className="btn-primary text-sm">
                  Связаться с нами
                </Link>
                <button
                  onClick={() => setSelectedService(null)}
                  className="btn-secondary text-sm"
                >
                  Закрыть
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mt-20 glass-card p-8 md:p-12 text-center"
        >
          <h2 className="text-2xl md:text-3xl font-bold text-neutral-900 dark:text-white mb-4">
            Нужна консультация?
          </h2>
          <p className="text-neutral-500 dark:text-gray-400 mb-6 max-w-xl mx-auto">
            Свяжитесь с нами через TZ.Connect для обсуждения вашего проекта.
            Мы поможем подобрать оптимальное решение для вашего бизнеса.
          </p>
          <Link href="/connect" className="btn-primary inline-block">
            Перейти в TZ.Connect
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
