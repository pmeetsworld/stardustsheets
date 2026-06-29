(function(){
  'use strict';

  var live = {
    name: 'p1.name',
    classLevel: 'p1.classlevel',
    species: 'p1.species',
    background: 'p1.background',
    level: 'p1.level',
    armorClass: 'p1.ac',
    initiative: 'p1.init',
    speed: 'p1.speed',
    passivePerception: 'p1.passive',
    proficiencyBonus: 'p1.prof',
    maxHp: 'p1.maxhp',
    currentHp: 'p1.curhp',
    tempHp: 'p1.temphp',
    hitDice: 'p1.hitdice',
    senses: 'p1.senses'
  };

  var skills = {
    perceptionMod: 'p1.sk.perc.m',
    insightMod: 'p1.sk.insi.m',
    investigationMod: 'p1.sk.inve.m'
  };

  var deathSaves = {
    successPrefix: 'p1.death.ok',
    failurePrefix: 'p1.death.f'
  };

  var conditionLabels = {
    blinded: 'Blinded',
    charmed: 'Charmed',
    deafened: 'Deafened',
    frightened: 'Frightened',
    grappled: 'Grappled',
    incapacitated: 'Incapacitated',
    invisible: 'Invisible',
    paralyzed: 'Paralyzed',
    petrified: 'Petrified',
    poisoned: 'Poisoned',
    prone: 'Prone',
    restrained: 'Restrained',
    stunned: 'Stunned',
    unconscious: 'Unconscious'
  };

  var profile = {
    personality: 'p3.personality',
    ideals: 'p3.ideals',
    bonds: 'p3.bonds',
    flaws: 'p3.flaws',
    goals: 'p3.goals',
    allies: 'p3.allies',
    appearance: 'p3.appearance',
    backstory: 'p5.backstory'
  };

  var spells = {
    castingClass: 'p4.spclass',
    ability: 'p4.spability',
    saveDc: 'p4.spdc',
    attackBonus: 'p4.spatk'
  };

  window.AEGIS_FIELDS = Object.freeze({
    live: Object.freeze(live),
    skills: Object.freeze(skills),
    deathSaves: Object.freeze(deathSaves),
    conditionPrefix: 'p1.cond.',
    conditionLabels: Object.freeze(conditionLabels),
    profile: Object.freeze(profile),
    spells: Object.freeze(spells)
  });
})();
