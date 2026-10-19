import type {Literal,Text} from 'mdast';
declare module 'mdast' {
  interface WikiEmbed extends Literal {type:'wikiEmbed';url:string;parameter:string;value:string;children:Text[]}
  interface WikiLink extends Literal {type:'wikiLink';url:string;parameter:string;value:string;children:Text[]}
  interface PhrasingContentMap {wikiEmbed:WikiEmbed;wikiLink:WikiLink}
  interface RootContentMap {wikiEmbed:WikiEmbed;wikiLink:WikiLink}
}
