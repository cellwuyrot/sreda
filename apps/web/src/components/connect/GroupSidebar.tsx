"use client";

import { useState } from "react";
import Image from "next/image";

interface Group {
  id: string;
  name: string;
  icon: string | null;
}

export type ConnectSection = "groups" | "friends" | "dm";

interface GroupSidebarProps {
  groups: Group[];
  selectedGroup: string | null;
  activeSection: ConnectSection;
  onSelectGroup: (id: string) => void;
  onCreateGroup: () => void;
  onJoinGroup: () => void;
  onChangeSection: (section: ConnectSection) => void;
}

function GroupIcon({ icon, name }: { icon: string | null; name: string }) {
  if (icon && icon.startsWith("/")) {
    return <Image src={icon} alt={name} width={48} height={48} className="w-full h-full object-cover" />;
  }
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
    </svg>
  );
}

export default function GroupSidebar({
  groups, selectedGroup, activeSection,
  onSelectGroup, onCreateGroup, onJoinGroup, onChangeSection,
}: GroupSidebarProps) {
  const [showGroups, setShowGroups] = useState(activeSection === "groups");

  const handleGroupsToggle = () => {
    if (showGroups && activeSection === "groups") {
      setShowGroups(false);
    } else {
      setShowGroups(!showGroups);
      onChangeSection("groups");
    }
  };

  const handleSelectGroup = (id: string) => {
    onChangeSection("groups");
    onSelectGroup(id);
  };

  return (
    <nav
      className="bg-neutral-100 dark:bg-neutral-950 border-r border-neutral-200 dark:border-white/5 flex flex-col items-center py-3 gap-2 h-full overflow-y-auto flex-shrink-0 max-md:hidden"
      style={{ width: showGroups ? "72px" : "72px" }}
      aria-label="Navigation"
    >
      {/* Section: Communities */}
      <button
        onClick={handleGroupsToggle}
        className={`w-12 h-12 rounded-2xl flex items-center justify-center hover:rounded-xl transition-all duration-300 ${
          activeSection === "groups"
            ? "bg-violet-500 dark:bg-cyan-500 text-white rounded-xl shadow-lg"
            : "bg-neutral-200 dark:bg-neutral-800 text-neutral-600 dark:text-gray-400 hover:bg-violet-200 dark:hover:bg-cyan-400/20 hover:text-violet-700 dark:hover:text-cyan-400"
        }`}
        title="Сообщества"
        aria-label="Сообщества"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
        </svg>
      </button>

      {/* Expanded group list */}
      {showGroups && (
        <>
          <div className="w-8 h-px bg-neutral-300 dark:bg-white/10 my-0.5" aria-hidden="true" />
          {groups.map((group) => (
            <button
              key={group.id}
              onClick={() => handleSelectGroup(group.id)}
              className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg transition-all duration-300 hover:rounded-xl overflow-hidden ${
                selectedGroup === group.id && activeSection === "groups"
                  ? "bg-violet-500 dark:bg-cyan-500 text-white rounded-xl shadow-lg"
                  : "bg-neutral-200 dark:bg-neutral-800 text-neutral-600 dark:text-gray-400 hover:bg-violet-200 dark:hover:bg-cyan-400/20 hover:text-violet-700 dark:hover:text-cyan-400"
              }`}
              title={group.name}
              aria-label={group.name}
            >
              <GroupIcon icon={group.icon} name={group.name} />
            </button>
          ))}

          <button
            onClick={onCreateGroup}
            className="w-12 h-12 rounded-2xl bg-neutral-200 dark:bg-neutral-800 text-green-600 dark:text-green-400 flex items-center justify-center hover:bg-green-100 dark:hover:bg-green-400/20 hover:rounded-xl transition-all duration-300"
            title="Создать группу"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>

          <button
            onClick={onJoinGroup}
            className="w-12 h-12 rounded-2xl bg-neutral-200 dark:bg-neutral-800 text-blue-600 dark:text-blue-400 flex items-center justify-center hover:bg-blue-100 dark:hover:bg-blue-400/20 hover:rounded-xl transition-all duration-300"
            title="Присоединиться"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          </button>
          <div className="w-8 h-px bg-neutral-300 dark:bg-white/10 my-0.5" aria-hidden="true" />
        </>
      )}

      {/* Section: Friends */}
      <button
        onClick={() => onChangeSection("friends")}
        className={`w-12 h-12 rounded-2xl flex items-center justify-center hover:rounded-xl transition-all duration-300 ${
          activeSection === "friends"
            ? "bg-amber-500 dark:bg-amber-500 text-white rounded-xl shadow-lg"
            : "bg-neutral-200 dark:bg-neutral-800 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-400/20"
        }`}
        title="Друзья"
        aria-label="Друзья"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {/* Section: Direct Messages */}
      <button
        onClick={() => onChangeSection("dm")}
        className={`w-12 h-12 rounded-2xl flex items-center justify-center hover:rounded-xl transition-all duration-300 ${
          activeSection === "dm"
            ? "bg-violet-500 dark:bg-cyan-500 text-white rounded-xl shadow-lg"
            : "bg-neutral-200 dark:bg-neutral-800 text-accent hover:bg-violet-100 dark:hover:bg-cyan-400/20"
        }`}
        title="Личные сообщения"
        aria-label="Личные сообщения"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </button>
    </nav>
  );
}
